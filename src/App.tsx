import { Route, Routes } from 'react-router-dom'
import { UpdatePrompt } from './app/UpdatePrompt'
import { useTheme } from './app/theme'
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

export default function App() {
  useTheme()
  return (
    <>
      <AppShell header={<span className="text-lg font-bold tracking-tight">Salud</span>}>
        <Routes>
          <Route path="/" element={<Placeholder title="Hoy" />} />
          <Route path="/mas" element={<MorePage />} />
          <Route path="*" element={<Placeholder title="Salud" />} />
        </Routes>
      </AppShell>
      <UpdatePrompt />
    </>
  )
}
