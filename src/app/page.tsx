export default function Home() {
  return (
    <main>
      <section className="panel" aria-labelledby="welcome-heading">
        <p className="eyebrow">Homebooks</p>
        <h1 id="welcome-heading">Your household books, in one place.</h1>
        <p className="description">
          The application foundation is ready. Account setup and secure sign-in are coming next.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          Application running
        </div>
      </section>
    </main>
  );
}
