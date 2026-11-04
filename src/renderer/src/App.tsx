import { useEffect } from 'react'
import { Rail } from './components/Rail'
import { TitleBar } from './components/TitleBar'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SignInScreen } from './screens/SignInScreen'
import { selectTheme, useStore } from './state/store'

export function App() {
  const screen = useStore((s) => s.screen)
  const theme = useStore(selectTheme)
  const setInfo = useStore((s) => s.setInfo)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  useEffect(() => {
    void window.kairo.app.info().then(setInfo)
  }, [setInfo])

  return (
    <div className="app">
      <HomeScreen active={screen === 'home'} />
      <LibraryScreen active={screen === 'library'} />
      <SettingsScreen active={screen === 'settings'} />
      <SignInScreen active={screen === 'signin'} />
      <Rail />
      <TitleBar />
    </div>
  )
}
