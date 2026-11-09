import { useEffect, useRef, useState } from 'react'
import { pictureUrl } from '../background/Background'
import { useStore } from '../state/store'

interface Props {
  /** Null for the dev offline account. */
  uuid: string | null
  name: string
  /** The skin it wears is known. */
  skin: boolean
  className?: string
}

/**
 * An account's picture: its own picture if the player chose one, else the
 * head of the skin it wears (face and hat layer, drawn pixel-sharp), else
 * its first letter.
 */
export function Avatar({ uuid, name, skin, className }: Props) {
  const own = useStore((s) => (uuid ? (s.bgFiles?.accounts[uuid] ?? null) : null))
  const skinsVersion = useStore((s) => s.skinsVersion)
  const [failed, setFailed] = useState<string | null>(null)
  const cls = `avatar ${className ?? ''}`

  const ownUrl = uuid && own ? pictureUrl(`account:${uuid}`, own.version) : null
  const skinUrl = uuid && skin ? `kairo-bg://skin/${uuid}?v=${skinsVersion}` : null

  if (ownUrl && failed !== ownUrl) {
    return (
      <span className={cls} data-kind="picture" aria-hidden="true">
        <img src={ownUrl} alt="" onError={() => setFailed(ownUrl)} />
      </span>
    )
  }
  if (skinUrl && failed !== skinUrl) {
    return (
      <span className={cls} data-kind="head" aria-hidden="true">
        <Head url={skinUrl} onFail={() => setFailed(skinUrl)} />
      </span>
    )
  }
  return (
    <span className={cls} data-kind="letter" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The front of the head (8 × 8 at 8,8) with the hat layer (at 40,8) on top. */
function Head({ url, onFail }: { url: string; onFail(): void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fail = useRef(onFail)
  fail.current = onFail
  useEffect(() => {
    let live = true
    const img = new Image()
    img.onload = () => {
      const ctx = ref.current?.getContext('2d')
      if (!live || !ctx) return
      if (img.naturalWidth !== 64 || (img.naturalHeight !== 64 && img.naturalHeight !== 32)) return fail.current()
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, 8, 8)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8)
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8)
    }
    img.onerror = () => live && fail.current()
    img.src = url
    return () => {
      live = false
    }
  }, [url])
  return <canvas ref={ref} width={8} height={8} />
}
