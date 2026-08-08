$packageJson = @"
{
  "name": "x-relationship-manager",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "idb": "^8.0.0",
    "lucide-react": "^0.300.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.4.7"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.21",
    "@types/chrome": "^0.0.258",
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.43",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.2.2",
    "vite": "^5.0.8"
  }
}
"@
Set-Content -Path "package.json" -Value $packageJson

$manifestJson = @"
{
  "manifest_version": 3,
  "name": "X Relationship Manager",
  "version": "1.0.0",
  "description": "X (Twitter) relationship manager extension",
  "action": {
    "default_popup": "index.html"
  },
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["*://x.com/*", "*://twitter.com/*"],
      "js": ["src/content/content.ts"]
    }
  ],
  "permissions": ["storage"],
  "host_permissions": ["*://x.com/*", "*://twitter.com/*"]
}
"@
Set-Content -Path "manifest.json" -Value $manifestJson

$viteConfig = @"
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
"@
Set-Content -Path "vite.config.ts" -Value $viteConfig

$tsconfig = @"
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "vite.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
"@
Set-Content -Path "tsconfig.json" -Value $tsconfig

$tsconfigNode = @"
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
"@
Set-Content -Path "tsconfig.node.json" -Value $tsconfigNode

$tailwindConfig = @"
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
"@
Set-Content -Path "tailwind.config.js" -Value $tailwindConfig

$postcssConfig = @"
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
"@
Set-Content -Path "postcss.config.js" -Value $postcssConfig

$indexHtml = @"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>X Relationship Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"@
Set-Content -Path "index.html" -Value $indexHtml

New-Item -ItemType Directory -Path "src" -Force | Out-Null
New-Item -ItemType Directory -Path "src/background" -Force | Out-Null
New-Item -ItemType Directory -Path "src/content" -Force | Out-Null
New-Item -ItemType Directory -Path "src/db" -Force | Out-Null
New-Item -ItemType Directory -Path "src/analysis" -Force | Out-Null
New-Item -ItemType Directory -Path "src/services" -Force | Out-Null
New-Item -ItemType Directory -Path "src/components" -Force | Out-Null
New-Item -ItemType Directory -Path "src/pages" -Force | Out-Null
New-Item -ItemType Directory -Path "src/store" -Force | Out-Null
New-Item -ItemType Directory -Path "src/types" -Force | Out-Null
New-Item -ItemType Directory -Path "src/utils" -Force | Out-Null

$mainTsx = @"
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
"@
Set-Content -Path "src/main.tsx" -Value $mainTsx

$indexCss = @"
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-gray-50 text-gray-900;
  }
}
"@
Set-Content -Path "src/index.css" -Value $indexCss

$appTsx = @"
import React from 'react';

function App() {
  const handleOpenDashboard = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  };

  return (
    <div className="w-80 p-4 bg-white">
      <h1 className="text-xl font-bold mb-4">X Relationship Manager</h1>
      
      <div className="space-y-4">
        <div className="flex justify-between">
          <span className="text-gray-600">Status</span>
          <span className="font-medium text-green-500">Ready</span>
        </div>
        
        <button 
          onClick={handleOpenDashboard}
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition-colors"
        >
          Open Dashboard
        </button>
      </div>
    </div>
  );
}

export default App;
"@
Set-Content -Path "src/App.tsx" -Value $appTsx

Set-Content -Path "src/background/service-worker.ts" -Value "console.log('Background service worker initialized.');"
Set-Content -Path "src/content/content.ts" -Value "console.log('Content script initialized on X.com');"

Write-Host "Setup files created successfully."
