import { useEffect } from 'react'
import { Background } from './background/Background'
import { Rail } from './components/Rail'
import { TitleBar } from './components/TitleBar'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SignInScreen } from './screens/SignInScreen'
import { applyLook } from './state/look'
import { selectLook, selectTheme, useStore } from './state/store'
import { VoidWarning } from './screens/VoidWarning'

export function App() {
  const screen = useStore((s) => s.screen)
  const theme = useStore(selectTheme)
  const look = useStore(selectLook)
  const setInfo = useStore((s) => s.setInfo)
  const setGame = useStore((s) => s.setGame)
  const refreshVersions = useStore((s) => s.refreshVersions)
  const refreshKairo = useStore((s) => s.refreshKairo)
  const refreshCustom = useStore((s) => s.refreshCustom)
  const setAccounts = useStore((s) => s.setAccounts)
  const loadSettings = useStore((s) => s.loadSettings)
  const setUpdate = useStore((s) => s.setUpdate)
  const setBgFiles = useStore((s) => s.setBgFiles)
  const go = useStore((s) => s.go)
  const loaded = useStore((s) => s.accounts !== null)

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  // The install's accent and rounding, as the theme's CSS variables (they crossfade).
  useEffect(() => applyLook(look), [look])

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
    void window.kairo.background.files().then(setBgFiles)
    const offUpdate = window.kairo.app.update.onState(setUpdate)
    const offGame = window.kairo.game.onState(setGame)
    return () => {
      offUpdate()
      offGame()
    }
  }, [setBgFiles, setUpdate, setInfo, setGame, refreshVersions, refreshKairo, refreshCustom, loadSettings, setAccounts, go])


  return (
    <div className="app" data-loaded={loaded}>
      <Background />
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
