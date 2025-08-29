import React, { useState, useEffect } from 'react';
import TCSinterviewAssistantAI from './components/TCSinterviewAssistantAI';
import './App.css';

function App() {
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem('popupShown')) {
      setShowPopup(true);
      sessionStorage.setItem('popupShown', 'true');
    }
  }, []);

  return (
    <div className="App">
      {showPopup && (
        <div className="popup-overlay">
          <div className="popup-content">
            <h2>ℹ️ PLEASE READ</h2>
            <p>
              <strong>The purpose of this demonstration is to highlight the transformative potential of Generative AI (GenAI).</strong> By seamlessly integrating programming expertise with GenAI-powered tools, it is possible to design and deploy a fully functional, enterprise-grade system in less than 6 hours—showcasing both the speed and scalability that modern AI brings to software development.
            </p>
            <button onClick={() => setShowPopup(false)}>Close</button>
          </div>
        </div>
      )}
      <TCSinterviewAssistantAI />
    </div>
  );
}

export default App;