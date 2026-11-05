import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LogView } from '../../../shared/api'
import { Modal } from '../components/Modal'
import { rovingKeyDown, rovingTabIndex } from '../components/roving'
import { useStore, type Install } from '../state/store'

type Problem = { title: string; message: string } | null

function ProblemLine({ problem }: { problem: Problem }) {
  if (!problem) return null
  return (
    <p className="modal-error" role="alert">
      <b>{problem.title}</b> {problem.message}
    </p>
  )
}

export function RenameDialog({ install, onDone, onClose }: { install: Install; onDone(): void; onClose(): void }) {
  const [name, setName] = useState(install.name)
  const [problem, setProblem] = useState<Problem>(null)
  const save = async () => {
    const r = await window.kairo.installs.rename(install.id, name)
    if (r.ok) onDone()
    else setProblem(r.error)
  }
  return (
    <Modal
      title="Rename install"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-accent" onClick={() => void save()} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="modal-field">
        <span className="field-label">Name</span>
        <input
          className="text-input"
          type="text"
          value={name}
          maxLength={48}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </label>
      <p className="modal-note">Only the name changes. Its folder, worlds and settings stay where they are.</p>
      <ProblemLine problem={problem} />
    </Modal>
  )
}

export function DeleteDialog({ install, onDone, onClose }: { install: Install; onDone(): void; onClose(): void }) {
  const [problem, setProblem] = useState<Problem>(null)
  const bin = useStore((s) => (s.info?.platform === 'win32' ? 'Recycle Bin' : 'Trash'))
  const remove = async () => {
    const r = await window.kairo.installs.remove(install.id)
    if (r.ok) onDone()
    else setProblem(r.error)
  }
  return (
    <Modal
      title={`Delete ${install.name}?`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} data-autofocus>
            Keep it
          </button>
          <button type="button" className="btn-danger" onClick={() => void remove()}>
            Move to {bin}
          </button>
        </>
      }
    >
      <p className="modal-text">Its worlds, settings, screenshots and mods move to the {bin}. You can still get them back from there.</p>
      <ProblemLine problem={problem} />
    </Modal>
  )
}

export function ChangeVersionDialog({ install, onDone, onClose }: { install: Install; onDone(): void; onClose(): void }) {
  const [versions, setVersions] = useState<string[] | null>(null)
  const [picked, setPicked] = useState(install.mc)
  const [problem, setProblem] = useState<Problem>(null)

  useEffect(() => {
    const load =
      install.edition === 'vanilla'
        ? window.kairo.game.versions().then((v) => v.releases)
        : window.kairo.loaders.versions(install.loader ?? 'fabric').then((v) => v.mcs)
    load.then(setVersions, () => setVersions([]))
  }, [install])

  const save = async () => {
    const r = await window.kairo.installs.changeVersion(install.id, picked)
    if (r.ok) onDone()
    else setProblem(r.error)
  }

  return (
    <Modal
      title="Change Minecraft version"
      wide
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-accent" onClick={() => void save()} disabled={picked === install.mc}>
            Change to {picked}
          </button>
        </>
      }
    >
      <p className="modal-note">
        The mods the launcher added are swapped for ones made for the new version on the next Play. Your own files stay. Back up
        worlds first: a world opened in a newer version may not open in an older one again.
      </p>
      <div
        role="radiogroup"
        aria-label="Minecraft version"
        aria-busy={versions === null}
        className="vgrid scroll modal-grid"
        data-roving
        onKeyDown={(e) => rovingKeyDown(e, { columns: 4 })}
      >
        {versions === null && <span className="field-label">Loading versions…</span>}
        {(versions ?? []).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            className="vcell"
            aria-checked={v === picked}
            tabIndex={rovingTabIndex(v === picked || (!versions?.includes(picked) && v === versions?.[0]))}
            onClick={() => setPicked(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <ProblemLine problem={problem} />
    </Modal>
  )
}

/** The game's output for one install, live while it runs. */
export function LogsDialog({ install, onClose }: { install: Install; onClose(): void }) {
  const [view, setView] = useState<LogView | null>(null)
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let live = true
    const load = () =>
      window.kairo.game.logs(install.id).then(
        (v) => live && setView(v),
        () => live && setView({ lines: [], live: false })
      )
    void load()
    const timer = setInterval(() => void load(), 1000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [install.id])

  // Follow new lines unless the player scrolled up to read.
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [view])

  const lines = view?.lines ?? []
  return (
    <Modal
      title={`Log: ${install.name}`}
      wide
      onClose={onClose}
      actions={
        <>
          <span className="modal-note log-state">
            {view === null ? 'Loading…' : view.live ? 'Live: the game is running' : lines.length ? 'From the last time it ran' : 'No log yet'}
          </span>
          <button type="button" className="btn-ghost" onClick={() => void window.kairo.installs.openFolder(install.id)}>
            Open folder
          </button>
          <button type="button" className="btn-accent" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <pre
        ref={box}
        className="log-view scroll"
        tabIndex={0}
        aria-label="Game log"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {lines.length === 0 && view !== null ? 'This install has no log yet. It appears the first time you play it.' : null}
        {lines.map((line, i) => (
          <span key={i} className={/\b(ERROR|FATAL)\b|Exception|^\s+at /.test(line) ? 'log-error' : /\bWARN\b/.test(line) ? 'log-warn' : undefined}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </Modal>
  )
}
