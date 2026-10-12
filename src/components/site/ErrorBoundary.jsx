// src/components/site/ErrorBoundary.jsx
// If a screen throws while drawing, the person sees a calm page with a way
// forward, not a blank white window. The details go to the console for
// whoever is debugging.

import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[screen failed]", error, info && info.componentStack);
  }

  componentDidUpdate(prev) {
    // moving to another page gives the new page its chance
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="oops" data-theme="write">
        <div className="oops__card">
          <p className="oops__mark" aria-hidden="true">
            ☕
          </p>
          <h1 className="hi-d">कुछ गड़बड़ हो गई</h1>
          <p className="hi">
            यह पन्ना ठीक से खुल नहीं पाया। पन्ना दोबारा खोलकर देखिए — आपकी पढ़ने की जगह और बुकमार्क सुरक्षित हैं।
          </p>
          <div className="oops__act">
            <button type="button" className="btn btn--solid" onClick={() => window.location.reload()}>
              पन्ना दोबारा खोलिए
            </button>
            <a className="btn" href="/">
              मुख पृष्ठ
            </a>
          </div>
        </div>
      </main>
    );
  }
}
