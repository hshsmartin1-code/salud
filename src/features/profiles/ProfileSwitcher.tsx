import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, useProfiles } from '../../app/profile'
import { Icon } from '../../ui/Icon'
import { Sheet } from '../../ui/kit'

export function ProfileSwitcher() {
  const { profiles, active, setActive } = useProfiles()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  if (!active) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex max-w-full items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm font-semibold shadow-card transition hover:bg-surface2"
        aria-label={`Perfil activo: ${active.name}. Cambiar perfil`}
        data-testid="profile-switcher"
      >
        <Avatar profile={active} size={26} />
        <span className="truncate">{active.name}</span>
        <Icon name="chevronDown" size={16} className="shrink-0 text-faint" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Perfiles">
        <div className="space-y-2 pb-2">
          {(profiles ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setActive(p.id)
                setOpen(false)
                nav('/')
              }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                p.id === active.id ? 'border-accent/50 bg-accent/5' : 'border-line hover:bg-surface2'
              }`}
            >
              <Avatar profile={p} size={36} />
              <span className="flex-1 font-semibold">{p.name}</span>
              {p.id === active.id ? <Icon name="check" className="text-accent" /> : null}
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => {
                setOpen(false)
                nav('/perfiles/nuevo')
              }}
            >
              <Icon name="plus" size={18} /> Agregar perfil
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => {
                setOpen(false)
                nav('/perfil')
              }}
            >
              <Icon name="edit" size={18} /> Editar perfil
            </button>
          </div>
          <p className="pt-1 text-center text-xs text-faint">Cada perfil ve solo sus propios datos.</p>
        </div>
      </Sheet>
    </>
  )
}
