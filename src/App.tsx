import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ProfileProvider, useProfiles } from './app/profile'
import { UpdatePrompt } from './app/UpdatePrompt'
import { useTheme } from './app/theme'
import { Onboarding } from './features/profiles/Onboarding'
import { ProfilePage } from './features/profiles/ProfilePage'
import { ProfileSwitcher } from './features/profiles/ProfileSwitcher'
import { FoodSearchPage, NutritionPage } from './features/nutrition/NutritionPage'
import { LabelPage } from './features/nutrition/LabelPage'
import { RecipeEditor, RecipesPage, TemplatesPage } from './features/nutrition/RecipesPage'
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
  // First run: keep the onboarding flow mounted until the person finishes it (goals, second profile).
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  useEffect(() => {
    if (profiles !== undefined && firstRun === null) setFirstRun(profiles.length === 0)
  }, [profiles, firstRun])
  if (profiles === undefined || firstRun === null) return <div className="min-h-dvh bg-bg" />
  if (firstRun || !active)
    return (
      <Routes>
        <Route path="/respaldo" element={<Placeholder title="Respaldo" />} />
        <Route path="*" element={<Onboarding onFinish={() => setFirstRun(false)} />} />
      </Routes>
    )
  return (
    <AppShell header={<ProfileSwitcher />}>
      <Routes key={active.id}>
        <Route path="/" element={<Placeholder title="Hoy" />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/perfiles/nuevo" element={<Onboarding embedded />} />
        <Route path="/comida" element={<NutritionPage />} />
        <Route path="/comida/buscar" element={<FoodSearchPage />} />
        <Route path="/comida/etiqueta" element={<LabelPage />} />
        <Route path="/comida/recetas" element={<RecipesPage />} />
        <Route path="/comida/recetas/:id" element={<RecipeEditor />} />
        <Route path="/comida/plantillas" element={<TemplatesPage />} />
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
