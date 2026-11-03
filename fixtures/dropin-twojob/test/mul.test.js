import { expect, test } from 'vitest'
import { mul } from '../src/math.js'
test('mul', () => expect(mul(2, 3)).toBe(6))
