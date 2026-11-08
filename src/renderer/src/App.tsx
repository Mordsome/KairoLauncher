import { useEffect } from 'react'
import { Rail } from './components/Rail'
import { TitleBar } from './components/TitleBar'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SignInScreen } from './screens/SignInScreen'
import { selectTheme, useStore } from './state/store'
import { VoidWarning } from './screens/VoidWarning'

export function App() {
  const screen = useStore((s) => s.screen)
  const theme = useStore(selectTheme)
  const setInfo = useStore((s) => s.setInfo)
  const setGame = useStore((s) => s.setGame)
  const refreshVersions = useStore((s) => s.refreshVersions)
  const refreshKairo = useStore((s) => s.refreshKairo)
  const refreshCustom = useStore((s) => s.refreshCustom)
  const setAccounts = useStore((s) => s.setAccounts)
  const loadSettings = useStore((s) => s.loadSettings)
  const setUpdate = useStore((s) => s.setUpdate)
  const go = useStore((s) => s.go)
  const loaded = useStore((s) => s.accounts !== null)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  useEffect(() => {
    void window.kairo.app.info().then(setInfo)
    // Someone already signed in goes straight to Home.
    void window.kairo.auth.state().then((state) => {
      setAccounts(state)
      if (state.active) go('home')
    })
    void refreshVersions()
    void refreshKairo()
    // Saved settings and the last selection need the installs list to check against.
    void refreshCustom().finally(() => void loadSettings())
    void window.kairo.game.state().then(setGame)
    void window.kairo.app.update.state().then(setUpdate)
    const offUpdate = window.kairo.app.update.onState(setUpdate)
    const offGame = window.kairo.game.onState(setGame)
    return () => {
      offUpdate()
      offGame()
    }
  }, [setUpdate, setInfo, setGame, refreshVersions, refreshKairo, refreshCustom, loadSettings, setAccounts, go])


  return (
    <div className="app" data-loaded={loaded}>
      <HomeScreen active={screen === 'home'} />
      <LibraryScreen active={screen === 'library'} />
      <SettingsScreen active={screen === 'settings'} />
      <SignInScreen active={screen === 'signin'} />
      <Rail />
      <TitleBar />
      <VoidWarning />
    </div>
  )
}
