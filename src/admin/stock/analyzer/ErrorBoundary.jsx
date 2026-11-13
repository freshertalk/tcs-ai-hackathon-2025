import React from "react";

/**
 * Keeps one broken panel from taking the whole desk down. If something inside
 * throws while drawing, the rest of the page stays up and this says what happened.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[desk] a panel failed to draw:", error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="an-card" role="alert">
        <h2 className="sv__sym">{this.props.title || "This panel could not be shown"}</h2>
        <p className="adm-alert adm-alert--error">
          Something went wrong while drawing this panel ({String(this.state.error.message || this.state.error)}). Nothing was sent to your broker: drawing a panel never places an order.
        </p>
        <p className="adm-small">
          If the site was just updated, the API server may still be running older code: stop <code>npm run dev</code>, start it again, then reload.
        </p>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </section>
    );
  }
}
