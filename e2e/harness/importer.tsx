// Test harness (served only by the e2e dev server, never part of a build): mounts the real
// PrivatePackImporter next to two real ExerciseIllustration probes, because Settings mounts the importer
// in the director's tree and this spec must not depend on that.
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { ExerciseIllustration, useExerciseMedia } from '../../src/features/training/exerciseMedia'
import { PrivatePackImporter } from '../../src/features/training/media/PrivatePackImporter'

function App() {
  const media = useExerciseMedia()
  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <PrivatePackImporter />
      <div data-testid="probe-squat">
        <ExerciseIllustration exerciseId="fedb:Barbell_Squat" media={media} item={undefined} />
      </div>
      <div data-testid="probe-covered">
        <ExerciseIllustration exerciseId="fedb:Decline_Crunch" media={media} item={undefined} />
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
