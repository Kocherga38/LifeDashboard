export default function DataPage() {
  return <main>
    <header>
      <div>
        <p className="eyebrow">TRELLIS / ТВОИ ДАННЫЕ</p>
        <h1>Данные</h1>
        <p className="muted">Сохрани резервную копию своих записей.</p>
      </div>
    </header>
    <section className="card">
      <h2>Резервная копия</h2>
      <p className="muted">Выгрузка включает записи, цели, задачи, настройки и бюджеты в формате JSON.</p>
      <a className="download-button" href="/api/export">Скачать данные JSON</a>
    </section>
  </main>
}
