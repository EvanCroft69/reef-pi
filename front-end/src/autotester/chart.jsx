// front-end/src/autotester/chart.jsx
import React from 'react'
import { ResponsiveContainer, Tooltip, YAxis, XAxis, LineChart, Line } from 'recharts'
import { connect } from 'react-redux'
import { fetchAutotesterResults } from 'redux/actions/autotester'
import { TwoDecimalParse } from 'utils/two_decimal_parse'

class Chart extends React.Component {
  componentDidMount() {
    const { param, fetchAutotesterResults } = this.props
    fetchAutotesterResults(param)
    this.timer = window.setInterval(() => {
      fetchAutotesterResults(param)
    }, 10_000)
  }

  componentWillUnmount() {
    clearInterval(this.timer)
  }

  render() {
    const { readings, param, label, unit, height } = this.props
    const data = readings[param] || []

    if (data.length === 0) {
      return <div className="text-muted">Perform a test to see data</div>
    }

    // Sort chronologically
    const sorted = data.slice().sort((a, b) =>
      a.ts > b.ts ? 1 : -1
    )
    // Latest value
    const current = TwoDecimalParse(sorted[sorted.length - 1].value)

    return (
      <div className="container">
        <span className="h6">{label} ({current} {unit})</span>
        <ResponsiveContainer height={height}>
          <LineChart data={sorted}>
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
              formatter={val => [TwoDecimalParse(val), unit]}
              labelFormatter={ts => new Date(ts * 1000).toLocaleString()}
            />
            <YAxis dataKey="value" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }
}

const mapStateToProps = state => ({
  readings: state.autotester_readings || {},
})

const mapDispatchToProps = dispatch => ({
  fetchAutotesterResults: param => dispatch(fetchAutotesterResults(param)),
})

export default connect(mapStateToProps, mapDispatchToProps)(Chart)
