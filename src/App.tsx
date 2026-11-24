import { lazy, Suspense, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { ProfileProvider, useProfiles } from './app/profile'
import { UpdatePrompt } from './app/UpdatePrompt'
import { HealthReporter } from './features/updates/HealthReporter'
import { UpdateBanner } from './features/updates/UpdateBanner'
import { useTheme } from './app/theme'
import { ProfileSwitcher } from './features/profiles/ProfileSwitcher'
import { NutritionPage } from './features/nutrition/NutritionPage'
import { TodayPage } from './features/dashboard/TodayPage'
import { requestPersistentStorage } from './db/schema'
import { ExerciseLibraryPage } from './features/training/ExerciseLibrary'
import { SessionPage } from './features/training/SessionPage'
import { AppShell, MORE_GROUPS } from './ui/AppShell'
import { ToastProfileGuard, UiProviders } from './ui/providers'
import { AdaptiveAutoRunner } from './features/energy/AdaptiveAutoRunner'
import { TrainingReminderCleanup, TrainingReminderSync } from './features/training/plan/TrainingReminderSync'
import { EmptyState, ListRow, PageHeader } from './ui/kit'
import { STORAGE_NOTE_SHORT } from './sync/copy'
import { ErrorBoundary } from './ui/ErrorBoundary'

// Charts (Recharts) load on demand so the first screen stays light.
const TrainingHome = lazy(() => import('./features/training/home/TrainingHome').then((m) => ({ default: m.TrainingHome })))
const HistoryPage = lazy(() => import('./features/training/home/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const StatsPage = lazy(() => import('./features/training/stats/StatsPage').then((m) => ({ default: m.StatsPage })))
const RoutineLibrary = lazy(() => import('./features/training/routines/RoutineLibrary').then((m) => ({ default: m.RoutineLibrary })))
const RoutineDetail = lazy(() => import('./features/training/routines/RoutineDetail').then((m) => ({ default: m.RoutineDetail })))
const RoutineEditor = lazy(() => import('./features/training/routines/RoutineEditor').then((m) => ({ default: m.RoutineEditor })))
const ExerciseDetailPage = lazy(() => import('./features/training/ExerciseDetail').then((m) => ({ default: m.ExerciseDetailPage })))
const Onboarding = lazy(() => import('./features/profiles/Onboarding').then((m) => ({ default: m.Onboarding })))
const ProfilePage = lazy(() => import('./features/profiles/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const PhotosPage = lazy(() => import('./features/photos/PhotosPage').then((m) => ({ default: m.PhotosPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ProgressPage = lazy(() => import('./features/progress/ProgressPage').then((m) => ({ default: m.ProgressPage })))
const MealTimesPage = lazy(() => import('./features/settings/MealTimesPage').then((m) => ({ default: m.MealTimesPage })))
const UpdatesPage = lazy(() => import('./features/updates/UpdatesPage').then((m) => ({ default: m.UpdatesPage })))
const BackupPage = lazy(() => import('./features/backup/BackupPage').then((m) => ({ default: m.BackupPage })))
// The nutrition diary is eager; search, recipes, templates and the label form load on demand.
const FoodSearchPage = lazy(() => import('./features/nutrition/FoodSearchPage').then((m) => ({ default: m.FoodSearchPage })))
const RecipesPage = lazy(() => import('./features/nutrition/RecipesPage').then((m) => ({ default: m.RecipesPage })))
const RecipeEditor = lazy(() => import('./features/nutrition/RecipesPage').then((m) => ({ default: m.RecipeEditor })))
const TemplatesPage = lazy(() => import('./features/nutrition/RecipesPage').then((m) => ({ default: m.TemplatesPage })))
const LabelPage = lazy(() => import('./features/nutrition/LabelPage').then((m) => ({ default: m.LabelPage })))
const AccountPage = lazy(() => import('./features/account/AccountPage').then((m) => ({ default: m.AccountPage })))
// Salud screens (overview, detail pages and their charts) are lazy chunks.
const HealthHubPage = lazy(() => import('./features/health/HealthHub').then((m) => ({ default: m.HealthHubPage })))
const ActivityPage = lazy(() => import('./features/health/HealthPages').then((m) => ({ default: m.ActivityPage })))
const SleepPage = lazy(() => import('./features/health/HealthPages').then((m) => ({ default: m.SleepPage })))
const HabitsPage = lazy(() => import('./features/health/HealthPages').then((m) => ({ default: m.HabitsPage })))
const VitalsPage = lazy(() => import('./features/vitals/VitalsPage').then((m) => ({ default: m.VitalsPage })))
const HydrationPage = lazy(() => import('./features/hydration/HydrationPage').then((m) => ({ default: m.HydrationPage })))
const BodyPage = lazy(() => import('./features/body/BodyPage').then((m) => ({ default: m.BodyPage })))
const MeasurementEditor = lazy(() => import('./features/body/MeasurementEditor').then((m) => ({ default: m.MeasurementEditor })))
const HealthConnectPage = lazy(() => import('./features/integrations/HealthConnectPage').then((m) => ({ default: m.HealthConnectPage })))

// Dev-only component gallery (#/dev/kit). `import.meta.env.DEV` is a build-time constant, so the
// dynamic import and its chunk are removed from production builds.
const KitGallery = import.meta.env.DEV ? lazy(() => import('./dev/KitGallery')) : null

const loadingPage = <p role="status" className="p-4 text-sm text-muted">Cargando…</p>

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
      <div className="space-y-5">
        <div className="tile divide-y divide-line overflow-hidden p-0">
          <ListRow to="/salud" icon="heart" title="Salud" subtitle="Cuerpo, actividad, sueño, signos vitales, agua, hábitos y fotos" />
        </div>
        {MORE_GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="section-title mb-2">{g.title}</h2>
            <div className="tile divide-y divide-line overflow-hidden p-0">
              {g.items.map((i) => (
                <ListRow key={i.to} to={i.to} icon={i.icon} title={i.label} />
              ))}
            </div>
          </section>
        ))}
        <p className="px-1 text-xs text-faint">{STORAGE_NOTE_SHORT}</p>
      </div>
    </>
  )
}

function Gate() {
  const { profiles, active } = useProfiles()
  const { pathname } = useLocation()
  // First run: keep the onboarding flow mounted until the person finishes it (goals, second profile).
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  useEffect(() => {
    if (profiles !== undefined && firstRun === null) setFirstRun(profiles.length === 0)
  }, [profiles, firstRun])
  // Once there is data worth keeping, ask the browser not to evict it (best effort, silent).
  useEffect(() => {
    if (active) void requestPersistentStorage()
  }, [active])
  if (profiles === undefined || firstRun === null) return <div className="min-h-dvh bg-bg" />
  if (firstRun || !active)
    return (
      <ErrorBoundary scope="route" resetKey={pathname}>
        <Suspense fallback={loadingPage}>{!firstRun ? <TrainingReminderCleanup /> : null}<Routes>
          <Route path="/respaldo" element={<BackupPage />} />
          <Route path="*" element={<Onboarding onFinish={() => setFirstRun(false)} />} />
        </Routes></Suspense>
      </ErrorBoundary>
    )
  return (
    <AppShell header={<ProfileSwitcher />}>
      <ToastProfileGuard profileId={active.id} />
      <UpdateBanner />
      {active.settings?.adaptive?.mode === 'auto' ? <AdaptiveAutoRunner key={`adaptive-${active.id}`} /> : null}
      <TrainingReminderSync key={`reminders-${active.id}`} />
      <ErrorBoundary scope="route" resetKey={`${active.id}|${pathname}`}><Suspense key={active.id} fallback={loadingPage}><Routes key={active.id}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/perfiles/nuevo" element={<Onboarding embedded />} />
        <Route path="/comida" element={<NutritionPage />} />
        <Route path="/comida/buscar" element={<FoodSearchPage />} />
        <Route path="/comida/etiqueta" element={<LabelPage />} />
        <Route path="/comida/recetas" element={<RecipesPage />} />
        <Route path="/comida/recetas/:id" element={<RecipeEditor />} />
        <Route path="/comida/plantillas" element={<TemplatesPage />} />
        <Route path="/entreno" element={<TrainingHome />} />
        <Route path="/entreno/historial" element={<HistoryPage />} />
        <Route path="/entreno/estadisticas" element={<StatsPage />} />
        <Route path="/entreno/ejercicios" element={<ExerciseLibraryPage />} />
        <Route path="/entreno/ejercicios/:id" element={<ExerciseDetailPage />} />
        <Route path="/entreno/rutinas" element={<RoutineLibrary />} />
        <Route path="/entreno/rutinas/nueva" element={<RoutineEditor />} />
        <Route path="/entreno/rutinas/:id" element={<RoutineDetail />} />
        <Route path="/entreno/rutinas/:id/editar" element={<RoutineEditor />} />
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
        <Route path="/salud" element={<HealthHubPage />} />
        <Route path="/signos" element={<VitalsPage />} />
        <Route path="/agua" element={<HydrationPage />} />
        <Route path="/fotos" element={<PhotosPage />} />
        <Route path="/integraciones" element={<HealthConnectPage />} />
        <Route path="/ajustes" element={<SettingsPage />} />
        <Route path="/ajustes/tiempos-de-comida" element={<MealTimesPage />} />
        <Route path="/ajustes/actualizaciones" element={<UpdatesPage />} />
        <Route
          path="/cuenta"
          element={
            <Suspense fallback={loadingPage}>
              <AccountPage />
            </Suspense>
          }
        />
        <Route path="/mas" element={<MorePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes></Suspense></ErrorBoundary>
    </AppShell>
  )
}

export default function App() {
  useTheme()
  return (
    <ErrorBoundary scope="app">
    <UiProviders>
      <ProfileProvider>
        <HealthReporter />
        {KitGallery ? (
          <Routes>
            <Route path="/dev/kit" element={<Suspense fallback={loadingPage}><KitGallery /></Suspense>} />
            <Route path="*" element={<Gate />} />
          </Routes>
        ) : (
          <Gate />
        )}
        <UpdatePrompt />
      </ProfileProvider>
    </UiProviders>
    </ErrorBoundary>
  )
}
