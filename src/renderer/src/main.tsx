import '@fontsource-variable/outfit'
import '@fontsource-variable/pixelify-sans'
import './styles/theme.css'
import './styles/base.css'
import './styles/home.css'
import './styles/pages.css'
import './styles/signin.css'
import './styles/background.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
