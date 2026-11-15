import { lazy, Suspense, useEffect, useState } from 'react'
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
import { TodayPage } from './features/dashboard/TodayPage'
import { ActivityPage, HabitsPage, SleepPage } from './features/health/HealthPages'
import { SettingsPage } from './features/settings/SettingsPage'
import { BackupPage } from './features/backup/BackupPage'
import { BodyPage, MeasurementEditor } from './features/body/BodyPage'
import { ExerciseLibraryPage } from './features/training/ExerciseLibrary'
import { SessionPage } from './features/training/SessionPage'
import { RoutineEditor as TrainingRoutineEditor, TrainingPage } from './features/training/TrainingPage'
import { AppShell, MORE_NAV } from './ui/AppShell'
import { EmptyState, ListRow, PageHeader } from './ui/kit'

// Charts (Recharts) load on demand so the first screen stays light.
const ProgressPage = lazy(() => import('./features/progress/ProgressPage').then((m) => ({ default: m.ProgressPage })))

function NotFound() {
  return (
    <>
      <PageHeader title="No encontrado" />
      <EmptyState icon="info" title="Esta página no existe">
        Revisa la dirección o vuelve al inicio desde el menú.
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
        <Route path="/respaldo" element={<BackupPage />} />
        <Route path="*" element={<Onboarding onFinish={() => setFirstRun(false)} />} />
      </Routes>
    )
  return (
    <AppShell header={<ProfileSwitcher />}>
      <Routes key={active.id}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/perfiles/nuevo" element={<Onboarding embedded />} />
        <Route path="/comida" element={<NutritionPage />} />
        <Route path="/comida/buscar" element={<FoodSearchPage />} />
        <Route path="/comida/etiqueta" element={<LabelPage />} />
        <Route path="/comida/recetas" element={<RecipesPage />} />
        <Route path="/comida/recetas/:id" element={<RecipeEditor />} />
        <Route path="/comida/plantillas" element={<TemplatesPage />} />
        <Route path="/entreno" element={<TrainingPage />} />
        <Route path="/entreno/ejercicios" element={<ExerciseLibraryPage />} />
        <Route path="/entreno/rutinas/:id" element={<TrainingRoutineEditor />} />
        <Route path="/entreno/sesion/:id" element={<SessionPage />} />
        <Route path="/cuerpo" element={<BodyPage />} />
        <Route path="/cuerpo/:id" element={<MeasurementEditor />} />
        <Route path="/respaldo" element={<BackupPage />} />
        <Route
          path="/progreso"
          element={
            <Suspense fallback={<p className="p-4 text-sm text-muted">Cargando gráficas…</p>}>
              <ProgressPage />
            </Suspense>
          }
        />
        <Route path="/actividad" element={<ActivityPage />} />
        <Route path="/sueno" element={<SleepPage />} />
        <Route path="/habitos" element={<HabitsPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="/mas" element={<MorePage />} />
        <Route path="*" element={<NotFound />} />
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
