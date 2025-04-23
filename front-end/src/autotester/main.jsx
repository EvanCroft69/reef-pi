// front-end/src/autotester/main.jsx
import React, { useState, useEffect } from 'react'

const PARAMS = [
  { key: 'ca',  label: 'Calcium',    unit: 'ppm' },
  { key: 'alk', label: 'Alkalinity', unit: 'dKH' },
  { key: 'mg',  label: 'Magnesium',  unit: 'ppm' },
  { key: 'no3', label: 'Nitrate',    unit: 'ppm', stub: true },
  { key: 'po4', label: 'Phosphate',  unit: 'ppm', stub: true },
]

export default function AutoTester() {
  const [cfg,  setCfg]  = useState(null)
  const [stat, setStat] = useState({})
  const [data, setData]  = useState({})

  // Load config on mount
  useEffect(() => {
    fetch('/api/autotester/config', { credentials: 'include' })
      .then(r => r.json())
      .then(setCfg)
  }, [])

  // Poll status every 2s
  useEffect(() => {
    if (!cfg) return
    const iv = setInterval(() => {
      PARAMS.forEach(({ key }) => {
        fetch(`/api/autotester/status/${key}`, { credentials: 'include' })
          .then(r => r.json())
          .then(js => setStat(s => ({ ...s, [key]: js.status })))
      })
    }, 2000)
    return () => clearInterval(iv)
  }, [cfg])

  // Load history on cfg change
  useEffect(() => {
    if (!cfg) return
    PARAMS.forEach(({ key }) => {
      fetch(`/api/autotester/results/${key}`, { credentials: 'include' })
        .then(r => r.json())
        .then(arr => setData(d => ({ ...d, [key]: arr })))
    })
  }, [cfg])

  if (!cfg) return <div>Loading Auto Tester…</div>

  // Update config on server
  const updateConfig = (newCfg) => {
    fetch('/api/autotester/config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCfg),
    }).then(() => setCfg(newCfg))
  }

  // Run a single test
  const runTest = key => {
    fetch(`/api/autotester/run/${key}`, {
      method: 'POST',
      credentials: 'include',
    })
    setStat(s => ({ ...s, [key]: 1 }))
  }

  // Calibrate pump or test
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
            {/* Schedule field */}
            <div className="form-group">
              <label>Schedule (RRULE):</label>
              <input
                type="text"
                className="form-control"
                value={cfg[`schedule_${p.key}`] || ''}
                disabled={!cfg[`enable_${p.key}`] || stat[p.key] === 1}
                onChange={e => {
                  const c = { ...cfg, [`schedule_${p.key}`]: e.target.value }
                  updateConfig(c)
                }}
              />
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

            {/* Historical data table (placeholder) */}
            <div style={{ maxHeight: '200px', overflowY: 'scroll' }}>
              {(data[p.key] || []).map((rec, i) => (
                <div key={i}>{new Date(rec.ts * 1000).toLocaleString()}: {rec.value} {p.unit}</div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
