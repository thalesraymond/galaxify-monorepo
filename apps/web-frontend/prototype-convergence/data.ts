// Synthetic scenario, shared by every visual candidate. Never calls real services.
export const dailies = [
  {
    id: 'walk',
    title: 'Walk outside for 20 minutes',
    description: 'Leave the screen. Take the long way home.',
    due: '12:00',
    difficulty: 'Medium',
    reward: 25,
    damage: 15,
    completed: false,
  },
  {
    id: 'read',
    title: 'Read ten pages',
    description: 'A little further in the book on your nightstand.',
    due: '18:00',
    difficulty: 'Easy',
    reward: 10,
    damage: 5,
    completed: false,
  },
  {
    id: 'stretch',
    title: 'Stretch for five minutes',
    description: 'Make a little room for the day.',
    due: '09:00',
    difficulty: 'Easy',
    reward: 10,
    damage: 5,
    completed: true,
  },
] as const

export const initialShip = { hull: 42, materials: 120, level: 3 }
export const repairFixture = { spent: 58, restored: 58 }
// Existing quote formula, not a new game rule. Quotes here are illustrations only.
export function successChance(investment: number, hull: number) {
  return Math.round((investment / (investment + 10)) * (hull / 100) * 100)
}
console.assert(initialShip.hull + repairFixture.restored === 100)
console.assert(initialShip.materials - repairFixture.spent === 62)
