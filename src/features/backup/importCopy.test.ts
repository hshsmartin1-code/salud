import { expect, it } from 'vitest'
import { choiceLabel } from '../../sync/fieldLabels'
import { safetyCopyFailedMessage } from './replaceFlow'

it('backup recovery names the safe import action distinctly from merging a sync conflict', () => {
  const message = safetyCopyFailedMessage('Perfil sintético', 'Sin archivo.')
  expect(message).toContain('usa «Añadir a lo existente»')
  expect(message).not.toContain('Combinar')
  expect(choiceLabel('merge', {}, {})).toBe('Combinar')
})
