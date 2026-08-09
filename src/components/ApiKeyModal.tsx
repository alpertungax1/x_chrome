import React, { useState } from 'react';
import { Key, ExternalLink } from 'lucide-react';
import { translations } from '../i18n';
import { useAppStore } from '../store/app-store';

interface ApiKeyModalProps {
  onSave: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave }) => {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const { language } = useAppStore();
  const t = translations[language as keyof typeof translations] || translations.en;

  const handleSave = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(language === 'tr' ? 'Lütfen geçerli bir anahtar girin.' : 'Please enter a valid key.');
      return;
    }
    
    // Basit bir uzunluk kontrolü (opsiyonel)
    if (trimmed.length < 10) {
      setError(language === 'tr' ? 'Anahtar çok kısa.' : 'Key is too short.');
      return;
    }

    onSave(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-blue-100 p-3 rounded-full mb-4">
            <Key className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 text-center">
            {language === 'tr' ? 'Sorsa API Anahtarı Gerekli' : 'Sorsa API Key Required'}
          </h2>
          <p className="text-sm text-gray-500 text-center mt-2 leading-relaxed">
            {language === 'tr' 
              ? "X Relationship Manager'ı tüm özellikleriyle ve en yüksek hızda (otomatik kaydırma olmadan) kullanabilmek için ücretsiz Sorsa API anahtarınızı girmelisiniz."
              : "To use X Relationship Manager with all features and highest speed (without auto-scrolling), you must enter your free Sorsa API key."}
          </p>
        </div>

        <div className="mb-6">
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-2">
            API Key
          </label>
          <input
            id="apiKey"
            type="text"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError('');
            }}
            placeholder="örn: 4b2ec005-4a2c-4f10-a5be-a49958d26c8c"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-gray-50"
            autoFocus
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="bg-blue-50 rounded-lg p-4 mb-6 border border-blue-100">
          <p className="text-sm text-blue-800 flex items-start gap-2">
            <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              {language === 'tr' ? 'Anahtarınız yok mu? Hemen ücretsiz alın:' : "Don't have a key? Get one for free:"}
              <br />
              <a 
                href="https://api.sorsa.io/overview/keys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="font-semibold underline text-blue-700 hover:text-blue-900 mt-1 inline-block"
              >
                https://api.sorsa.io/overview/keys
              </a>
            </span>
          </p>
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors shadow-md flex items-center justify-center gap-2"
        >
          <Key className="w-5 h-5" />
          {language === 'tr' ? 'Anahtarı Kaydet ve Başla' : 'Save Key and Start'}
        </button>
      </div>
    </div>
  );
};
