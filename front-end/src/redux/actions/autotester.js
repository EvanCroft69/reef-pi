// front-end/src/redux/actions/autotester.js

// Action types — you can add these to your existing actionTypes file, or inline as strings.
export const FETCH_AUTOTESTER_RESULTS_REQUEST = 'FETCH_AUTOTESTER_RESULTS_REQUEST'
export const FETCH_AUTOTESTER_RESULTS_SUCCESS = 'FETCH_AUTOTESTER_RESULTS_SUCCESS'
export const FETCH_AUTOTESTER_RESULTS_FAILURE = 'FETCH_AUTOTESTER_RESULTS_FAILURE'

// Thunk action to fetch the last N readings for a given param.
export const fetchAutotesterResults = (param) => async (dispatch) => {
  dispatch({ type: FETCH_AUTOTESTER_RESULTS_REQUEST, param })
  try {
    const res = await fetch(`/api/autotester/results/${param}`, {
      credentials: 'include',
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json()
    dispatch({
      type: FETCH_AUTOTESTER_RESULTS_SUCCESS,
      param,
      data,
    })
  } catch (err) {
    dispatch({
      type: FETCH_AUTOTESTER_RESULTS_FAILURE,
      param,
      error: err.message,
    })
  }
}
