import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { listProfiles, readActiveProfileId, writeActiveProfileId } from '../db/profiles'
import { repo, type Repo } from '../db/repo'
import type { Profile, ProfileColor } from '../db/types'
import { applyAccent, PROFILE_ACCENTS } from './accent'

interface ProfileCtx {
  profiles: Profile[] | undefined
  active: Profile | null
  setActive: (id: string) => void
}
const Ctx = createContext<ProfileCtx | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const profiles = useLiveQuery(() => listProfiles(), [])
  const [activeId, setActiveId] = useState<string | null>(readActiveProfileId)
  const active = useMemo(() => {
    if (!profiles || profiles.length === 0) return null
    return profiles.find((p) => p.id === activeId) ?? profiles[0]
  }, [profiles, activeId])
  useEffect(() => applyAccent(active?.color), [active?.color])
  const value = useMemo<ProfileCtx>(
    () => ({
      profiles,
      active,
      setActive: (id) => {
        writeActiveProfileId(id)
        setActiveId(id)
      },
    }),
    [profiles, active],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProfiles(): ProfileCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('ProfileProvider ausente')
  return c
}

/** Active profile; only call inside routes rendered when a profile exists. */
export function useProfile(): Profile {
  const { active } = useProfiles()
  if (!active) throw new Error('No hay perfil activo')
  return active
}

export function useRepo(): Repo {
  const p = useProfile()
  return useMemo(() => repo(p.id), [p.id])
}

export const PROFILE_COLORS: Record<ProfileColor, string> = Object.fromEntries(
  Object.entries(PROFILE_ACCENTS).map(([k, v]) => [k, v.swatch]),
) as Record<ProfileColor, string>

export function Avatar({ profile, size = 28 }: { profile: Pick<Profile, 'name' | 'color'>; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: PROFILE_COLORS[profile.color], fontSize: size * 0.42 }}
      aria-hidden
    >
      {profile.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
