import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LIFE: ошибка раздела', error, info.componentStack)
  }
  render() {
    return this.state.error ? (
      <main>
        <section className="card">
          <h1>Раздел не открылся</h1>
          <p>Остальные разделы доступны в меню. Скопируй сообщение ниже, если ошибка повторится.</p>
          <pre className="error-detail">{this.state.error}</pre>
          <button onClick={() => this.setState({ error: '' })}>Повторить</button>
        </section>
      </main>
    ) : (
      this.props.children
    )
  }
}
