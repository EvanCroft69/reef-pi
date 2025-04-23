// front-end/src/autotester/main.jsx
import React, { useState, useEffect } from 'react'
import Chart from './chart'

const PARAMS = [
  { key: 'ca',  label: 'Calcium',    unit: 'ppm' },
  { key: 'alk', label: 'Alkalinity', unit: 'dKH' },
  { key: 'mg',  label: 'Magnesium',  unit: 'ppm' },
  { key: 'no3', label: 'Nitrate',    unit: 'ppm', stub: true },
  { key: 'po4', label: 'Phosphate',  unit: 'ppm', stub: true },
]

// Must match the Go-side default in Setup()
const DEFAULT_CFG = {
  id:           'default',
  enable:       false,
  i2c_addr:     0x10,
  enable_ca:    false,
  enable_alk:   false,
  enable_mg:    false,
  enable_no3:   false,
  enable_po4:   false,
  schedule_ca:  '',
  schedule_alk: '',
  schedule_mg:  '',
  schedule_no3: '',
  schedule_po4: '',
}

export default function AutoTester() {
  const [cfg,  setCfg]  = useState(DEFAULT_CFG)
  const [stat, setStat] = useState({})
  const [data, setData] = useState({})

  // 1) Fetch real config and overwrite defaults
  useEffect(() => {
    fetch('/api/autotester/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setCfg)
      .catch(() => setCfg(DEFAULT_CFG))
  }, [])

  // 2) Poll status every 2s
  const iv = setInterval(async () => {
         for (const { key } of PARAMS) {
           const js = await fetch(`/api/autotester/status/${key}`, { credentials: 'include' })
                           .then(r => r.json());
           setStat(s => ({ ...s, [key]: js.status }));
           // when it flips back to 0 (idle), re-load that parameter’s history
           if (js.status === 0) {
             const arr = await fetch(`/api/autotester/results/${key}`, { credentials: 'include' })
                             .then(r => r.json());
             setData(d => ({ ...d, [key]: arr }));
           }
         }
       }, 2000);
       
  // 3) Load history once and whenever cfg changes
  useEffect(() => {
    PARAMS.forEach(({ key }) => {
      fetch(`/api/autotester/results/${key}`, { credentials: 'include' })
        .then(r => r.json())
        .then(arr => setData(d => ({ ...d, [key]: arr })))
    })
  }, [cfg])

  // 4) Handlers
  const updateConfig = newCfg => {
    fetch('/api/autotester/config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCfg),
    }).then(() => setCfg(newCfg))
  }

  const runTest = key => {
    fetch(`/api/autotester/run/${key}`, {
      method: 'POST',
      credentials: 'include',
    })
    setStat(s => ({ ...s, [key]: 1 }))
  }

  const calibrate = key => {
    fetch(`/api/autotester/calibrate/${key}`, {
      method: 'POST',
      credentials: 'include',
    })
  }

  return (
    <div className="container mt-4">
      <h2>Auto Tester</h2>
      {PARAMS.map(p => (
        <div className="card mb-4" key={p.key}>
          <div className="card-header d-flex justify-content-between">
            <strong>{p.label}</strong>
            <input
              type="checkbox"
              checked={cfg[`enable_${p.key}`]}
              disabled={stat[p.key] === 1}
              onChange={e => {
                const c = { ...cfg, [`enable_${p.key}`]: e.target.checked }
                updateConfig(c)
              }}
            />
          </div>
          <div className="card-body">
            {/* Schedule picker */}
            <div className="form-group">
              <label>Schedule:</label>
              <select
                className="form-control"
                value={cfg[`schedule_${p.key}`] || ''}
                disabled={!cfg[`enable_${p.key}`] || stat[p.key] === 1}
                onChange={e => {
                  const c = { ...cfg, [`schedule_${p.key}`]: e.target.value }
                  updateConfig(c)
                }}
              >
                <option value="">Disabled</option>
                <option value="FREQ=HOURLY;INTERVAL=4">Every 4 hours</option>
                <option value="FREQ=HOURLY;INTERVAL=8">Every 8 hours</option>
                <option value="FREQ=HOURLY;INTERVAL=12">Every 12 hours</option>
                <option value="FREQ=DAILY;INTERVAL=1">Every 24 hours</option>
              </select>
            </div>

            {/* Action buttons */}
            <button
              className="btn btn-primary mr-2"
              disabled={!cfg[`enable_${p.key}`] || stat[p.key] === 1 || p.stub}
              onClick={() => runTest(p.key)}
            >
              Run Now
            </button>
            <button
              className="btn btn-secondary mr-2"
              disabled={stat[p.key] === 1}
              onClick={() => calibrate('pump')}
            >
              Calibrate Pump
            </button>
            <button
              className="btn btn-secondary"
              disabled={stat[p.key] === 1 || p.stub}
              onClick={() => calibrate(p.key)}
            >
              Calibrate {p.label}
            </button>

            {/* Status indicator */}
            <span className="ml-3">
              {stat[p.key] === 0 && 'Idle'}
              {stat[p.key] === 1 && <><i className="fa fa-spinner fa-spin" /> Running</>}
              {stat[p.key] === 2 && 'Error'}
            </span>

            <hr />

            {/* Only show chart if we have data, otherwise placeholder */}
            {Array.isArray(data[p.key]) && data[p.key].length > 0 ? (
              <Chart
                data={data[p.key]}
                label={p.label}
                unit={p.unit}
                height={200}
              />
            ) : (
              <div className="text-muted">Perform a test to see data</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
