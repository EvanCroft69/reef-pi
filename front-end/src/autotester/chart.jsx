// front-end/src/autotester/chart.jsx
import React from 'react'
import {
  ResponsiveContainer,
  Tooltip,
  YAxis,
  XAxis,
  LineChart,
  Line
} from 'recharts'

export default function Chart({ data = [], label, unit, height }) {
  // Expect data = [{ ts: 162..., value: 7.5 }, ...]
  return (
    <div className="container">
      <span className="h6">{label}</span>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <Line
            dataKey="value"
            stroke="#8884d8"
            isAnimationActive={false}
            dot={false}
          />
          <XAxis
            dataKey="ts"
            tickFormatter={ts => new Date(ts * 1000).toLocaleTimeString()}
          />
          <Tooltip
            labelFormatter={ts => new Date(ts * 1000).toLocaleString()}
            formatter={val => [val, unit]}
          />
          <YAxis />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
