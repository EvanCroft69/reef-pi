package autotester

import (
	"encoding/binary"
	"encoding/json"

	"math"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/reef-pi/reef-pi/controller"
	"github.com/reef-pi/rpi/i2c"
	"github.com/teambition/rrule-go"
)

// BoltDB buckets for config & readings
const (
	configBucket  = "autotester_config"
	resultsBucket = "autotester_readings"
)

// Config holds the Auto Tester configuration.
type Config struct {
	ID      string `json:"id"`
	Enable  bool   `json:"enable"`
	I2CAddr byte   `json:"i2c_addr"` // e.g. 0x10

	EnableCa  bool `json:"enable_ca"`
	EnableAlk bool `json:"enable_alk"`
	EnableMg  bool `json:"enable_mg"`
	EnableNo3 bool `json:"enable_no3"`
	EnablePo4 bool `json:"enable_po4"`

	ScheduleCa  string `json:"schedule_ca"` // RRULE e.g. FREQ=DAILY;BYHOUR=6
	ScheduleAlk string `json:"schedule_alk"`
	ScheduleMg  string `json:"schedule_mg"`
	ScheduleNo3 string `json:"schedule_no3"`
	SchedulePo4 string `json:"schedule_po4"`
}

// Controller implements controller.Subsystem.
type Controller struct {
	c        controller.Controller
	bus      i2c.Bus
	devMode  bool
	quitters map[string]chan struct{}
}

// New constructs the Auto-Tester subsystem.
func New(devMode bool, c controller.Controller) (*Controller, error) {
	if err := c.Store().CreateBucket(configBucket); err != nil {
		return nil, err
	}
	if err := c.Store().CreateBucket(resultsBucket); err != nil {
		return nil, err
	}
	bus, err := i2c.New() // opens /dev/i2c-1
	if err != nil {
		return nil, err
	}
	return &Controller{
		c:        c,
		bus:      bus,
		devMode:  devMode,
		quitters: make(map[string]chan struct{}),
	}, nil
}

// Setup is called once at startup; no special action here.
func (m *Controller) Setup() error { return nil }

// Start reads the config and spins up one scheduler per enabled parameter.
func (m *Controller) Start() {
	cfg, err := m.Get("default")
	if err != nil {
		m.c.LogError("autotester", "load config: "+err.Error())
		return
	}
	addr := cfg.I2CAddr

	if cfg.EnableCa {
		q := make(chan struct{})
		m.quitters["ca"] = q
		go m.scheduleLoop("ca", addr, 0x11, cfg.ScheduleCa, q)
	}
	if cfg.EnableAlk {
		q := make(chan struct{})
		m.quitters["alk"] = q
		go m.scheduleLoop("alk", addr, 0x12, cfg.ScheduleAlk, q)
	}
	if cfg.EnableMg {
		q := make(chan struct{})
		m.quitters["mg"] = q
		go m.scheduleLoop("mg", addr, 0x13, cfg.ScheduleMg, q)
	}
	if cfg.EnableNo3 {
		q := make(chan struct{})
		m.quitters["no3"] = q
		go m.scheduleLoop("no3", addr, 0x14, cfg.ScheduleNo3, q)
	}
	if cfg.EnablePo4 {
		q := make(chan struct{})
		m.quitters["po4"] = q
		go m.scheduleLoop("po4", addr, 0x15, cfg.SchedulePo4, q)
	}
}

// scheduleLoop waits for the next RRULE occurrence then runs the test handshake.
func (m *Controller) scheduleLoop(
	key string, addr, opcode byte,
	ruleStr string, quit chan struct{},
) {
	// Build an rrule with DTSTART=now + user rule string
	rr, err := rrule.StrToRRule(
		"DTSTART=" +
			time.Now().UTC().Format("20060102T150405Z") +
			";" + ruleStr,
	)
	if err != nil {
		m.c.LogError("autotester", key+": invalid schedule "+err.Error())
		return
	}
	for {
		next := rr.After(time.Now(), false)
		select {
		case <-time.After(time.Until(next)):
			m.runTest(key, addr, opcode)
		case <-quit:
			return
		}
	}
}

// runTest does: START, poll GET_STATUS, READ_RESULT, and store the float32 result.
func (m *Controller) runTest(key string, addr, opcode byte) {
	// 1) Send START opcode
	if err := m.bus.WriteBytes(addr, []byte{opcode}); err != nil {
		m.c.LogError("autotester", key+": start error "+err.Error())
		return
	}
	// 2) Poll until idle or error
	for {
		time.Sleep(500 * time.Millisecond)
		m.bus.WriteBytes(addr, []byte{0x31}) // GET_STATUS
		st, err := m.bus.ReadBytes(addr, 1)
		if err != nil {
			m.c.LogError("autotester", key+": status read err "+err.Error())
			return
		}
		switch st[0] {
		case 0: // idle
			break
		case 2: // error
			m.c.LogError("autotester", key+": device error")
			return
		default: // busy
			continue
		}
		break
	}
	// 3) READ_RESULT
	m.bus.WriteBytes(addr, []byte{0x32})
	data, err := m.bus.ReadBytes(addr, 4)
	if err != nil {
		m.c.LogError("autotester", key+": result read err "+err.Error())
		return
	}
	value := math.Float32frombits(binary.LittleEndian.Uint32(data))
	// 4) Store in BoltDB
	rec := struct {
		ID    string  `json:"id"`
		Param string  `json:"param"`
		Time  int64   `json:"ts"`
		Value float32 `json:"value"`
	}{Param: key, Time: time.Now().Unix(), Value: value}
	fn := func(id string) interface{} { rec.ID = id; return &rec }
	if err := m.c.Store().Create(resultsBucket, fn); err != nil {
		m.c.LogError("autotester", key+": store err "+err.Error())
	}
}

// LoadAPI mounts all of the REST handlers under /api/autotester.
func (m *Controller) LoadAPI(r *mux.Router) {
	sr := r.PathPrefix("/api/autotester").Subrouter()
	sr.HandleFunc("/config", m.getConfig).Methods("GET")
	sr.HandleFunc("/config", m.putConfig).Methods("PUT")
	sr.HandleFunc("/run/{param}", m.runOne).Methods("POST")
	sr.HandleFunc("/calibrate/{param}", m.calibrateOne).Methods("POST")
	sr.HandleFunc("/status/{param}", m.statusOne).Methods("GET")
	sr.HandleFunc("/results/{param}", m.resultsOne).Methods("GET")
}

func (m *Controller) getConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := m.Get("default")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(cfg)
}

func (m *Controller) putConfig(w http.ResponseWriter, r *http.Request) {
	var cfg Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	cfg.ID = "default"
	if err := m.CreateOrUpdate(cfg); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (m *Controller) runOne(w http.ResponseWriter, r *http.Request) {
	key := mux.Vars(r)["param"]
	code := map[string]byte{"ca": 0x11, "alk": 0x12, "mg": 0x13, "no3": 0x14, "po4": 0x15}[key]
	go m.runTest(key, m.getConfigI2C(), code)
	w.WriteHeader(http.StatusNoContent)
}

func (m *Controller) calibrateOne(w http.ResponseWriter, r *http.Request) {
	key := mux.Vars(r)["param"]
	code := map[string]byte{"pump": 0x21, "ca": 0x22, "alk": 0x23, "mg": 0x24, "no3": 0x25, "po4": 0x26}[key]
	go m.runTest(key, m.getConfigI2C(), code)
	w.WriteHeader(http.StatusNoContent)
}

func (m *Controller) statusOne(w http.ResponseWriter, r *http.Request) {
	addr := m.getConfigI2C()
	m.bus.WriteBytes(addr, []byte{0x31})
	st, err := m.bus.ReadBytes(addr, 1)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]int{"status": int(st[0])})
}

func (m *Controller) resultsOne(w http.ResponseWriter, r *http.Request) {
	key := mux.Vars(r)["param"]
	var out []map[string]interface{}
	fn := func(_ string, v []byte) error {
		var rec struct {
			Param string
			Time  int64
			Value float32
		}
		_ = json.Unmarshal(v, &rec)
		if rec.Param == key {
			out = append(out, map[string]interface{}{
				"ts":    rec.Time,
				"value": rec.Value,
			})
		}
		return nil
	}
	_ = m.c.Store().List(resultsBucket, fn)
	json.NewEncoder(w).Encode(out)
}

// getConfigI2C returns the saved I²C addr, falling back to 0x10.
func (m *Controller) getConfigI2C() byte {
	cfg, err := m.Get("default")
	if err != nil {
		return 0x10
	}
	return cfg.I2CAddr
}

// CRUD against configBucket

func (m *Controller) Get(id string) (Config, error) {
	var cfg Config
	return cfg, m.c.Store().Get(configBucket, id, &cfg)
}

func (m *Controller) List() ([]Config, error) {
	var list []Config
	fn := func(_ string, v []byte) error {
		var c Config
		_ = json.Unmarshal(v, &c)
		list = append(list, c)
		return nil
	}
	return list, m.c.Store().List(configBucket, fn)
}

func (m *Controller) CreateOrUpdate(cfg Config) error {
	fn := func(id string) interface{} {
		cfg.ID = id
		return &cfg
	}
	if err := m.c.Store().Create(configBucket, fn); err != nil {
		return m.c.Store().Update(configBucket, cfg.ID, cfg)
	}
	return nil
}

// Stub methods to satisfy controller.Subsystem

func (m *Controller) InUse(string, string) ([]string, error)      { return nil, nil }
func (m *Controller) On(string, bool) error                       { return nil }
func (m *Controller) Stop()                                       {}
func (m *Controller) GetEntity(string) (controller.Entity, error) { return nil, nil }
