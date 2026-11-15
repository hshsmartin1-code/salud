import { Route, Routes } from 'react-router-dom'
import { ProfileProvider, useProfiles } from './app/profile'
import { UpdatePrompt } from './app/UpdatePrompt'
import { useTheme } from './app/theme'
import { Onboarding } from './features/profiles/Onboarding'
import { ProfilePage } from './features/profiles/ProfilePage'
import { ProfileSwitcher } from './features/profiles/ProfileSwitcher'
import { AppShell, MORE_NAV } from './ui/AppShell'
import { EmptyState, ListRow, PageHeader } from './ui/kit'

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon="info" title="Sección en construcción">
        Esta pantalla todavía no está implementada.
      </EmptyState>
    </>
  )
}

function MorePage() {
  return (
    <>
      <PageHeader title="Más" />
      <div className="card divide-y divide-line overflow-hidden">
        {MORE_NAV.map((i) => (
          <ListRow key={i.to} to={i.to} icon={i.icon} title={i.label} />
        ))}
      </div>
    </>
  )
}

function Gate() {
  const { profiles, active } = useProfiles()
  if (profiles === undefined) return <div className="min-h-dvh bg-bg" />
  if (!active)
    return (
      <Routes>
        <Route path="/respaldo" element={<Placeholder title="Respaldo" />} />
        <Route path="*" element={<Onboarding />} />
      </Routes>
    )
  return (
    <AppShell header={<ProfileSwitcher />}>
      <Routes key={active.id}>
        <Route path="/" element={<Placeholder title="Hoy" />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/perfiles/nuevo" element={<Onboarding embedded />} />
        <Route path="/mas" element={<MorePage />} />
        <Route path="*" element={<Placeholder title="Salud" />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  useTheme()
  return (
    <ProfileProvider>
      <Gate />
      <UpdatePrompt />
    </ProfileProvider>
  )
}
