import React, { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';

function App() {
  const [isPopup, setIsPopup] = useState(true);

  useEffect(() => {
    // Determine if we are running in the popup or full page
    // A simple way is to check window dimensions or URL
    if (window.innerWidth > 600) {
      setIsPopup(false);
    }
  }, []);

  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  };

  if (!isPopup) {
    return <Dashboard />;
  }

  return (
    <div className="w-80 p-5 bg-white text-gray-900">
      <h1 className="text-lg font-bold mb-6">X Relationship Manager</h1>
      
      <div className="space-y-6">
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
          <span className="text-gray-600 text-sm font-medium">Extension Status</span>
          <span className="flex items-center text-sm font-semibold text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
            Active
          </span>
        </div>
        
        <button 
          onClick={handleOpenDashboard}
          className="w-full bg-gray-900 text-white py-2.5 rounded-lg font-medium hover:bg-gray-800 transition-colors shadow-sm"
        >
          Open Dashboard
        </button>
      </div>
    </div>
  );
}

export default App;
