import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import AppOld from './App_old.jsx'
import './styles.css'

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Erreur inconnue' }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Erreur React capturée:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#e2e8f0', fontFamily: 'Inter, Arial, sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>Une erreur est survenue dans l’application</h2>
          <p style={{ color: '#94a3b8' }}>{this.state.message}</p>
          <p style={{ color: '#94a3b8' }}>Ouvre la console du navigateur pour voir le détail.</p>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/old" element={<AppOld />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
)
