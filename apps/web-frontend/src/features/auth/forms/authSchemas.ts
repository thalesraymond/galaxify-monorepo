import { z } from 'zod'

export const zSignupForm = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address.')),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be 3–30 characters.')
    .max(30, 'Username must be 3–30 characters.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export type SignupForm = z.infer<typeof zSignupForm>

export const zLoginForm = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
})

export type LoginForm = z.infer<typeof zLoginForm>
