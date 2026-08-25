'use client'

import { useState, type FormEvent } from 'react'
import {
  Alert,
  Button,
  Center,
  Container,
  Field,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react'
import { useAuth } from '@saas-ui/auth-provider'
import { toast } from '@saas-ui/react'
import { useMutation } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'

import { Form, useAppForm } from '@workspace/ui/form'

import { Link } from '#components/link'

import {
  EmailVerificationRequiredError,
  verifySignupEmail,
} from './auth-provider'
import { AuthCard } from './components/auth-card'
import { Testimonial } from './components/testimonial'
import { type SignupFormInput, signupSchema } from './schema/signup.schema'

export const SignupPage = () => {
  const search = useSearch({
    from: '/_auth/signup',
  })
  const auth = useAuth()
  const [pendingVerification, setPendingVerification] = useState<{
    email: string
    password: string
    userId: string
  } | null>(null)
  const [verificationCode, setVerificationCode] = useState('')

  const { mutateAsync, isPending, isSuccess, error } = useMutation({
    mutationFn: (params: SignupFormInput) => auth.signUp(params),
    onSuccess: () => {
      window.location.assign(search.redirectTo ?? '/')
    },
    onError: (error, variables) => {
      if (error instanceof EmailVerificationRequiredError) {
        setPendingVerification({
          email: variables.email,
          password: variables.password,
          userId: error.userId,
        })
        return
      }
      toast.error({
        title: error.message ?? 'Could not sign you up',
        description: 'Please try again or contact us if the problem persists.',
      })
    },
  })

  const verification = useMutation({
    mutationFn: verifySignupEmail,
    onSuccess: () => {
      window.location.assign(search.redirectTo ?? '/')
    },
  })

  const verificationRequired = pendingVerification !== null

  const submitVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pendingVerification || !verificationCode.trim()) return
    await verification.mutateAsync({
      ...pendingVerification,
      verificationCode: verificationCode.trim(),
    })
  }

  const form = useAppForm({
    validators: {
      onBlur: signupSchema,
      onSubmit: signupSchema,
    },
    defaultValues: {
      email: '',
      password: '',
    },
    onSubmit: async ({ value }: { value: SignupFormInput }) => {
      await mutateAsync({
        email: value.email,
        password: value.password,
      })
    },
  })

  return (
    <Stack flex="1" direction="row" height="100dvh" bg="bg.muted">
      <Stack
        flex="1"
        alignItems="center"
        justify="center"
        direction="column"
        gap="8"
        textStyle="sm"
      >
        <Container maxW="md" py="8">
          <AuthCard
            title="Sign up"
            footer={
              <Text color="fg.muted">
                Already have an account? <Link to="/login">Log in</Link>.
              </Text>
            }
          >
            {verificationRequired ? (
              <Alert.Root status="success" mb="4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Check your email</Alert.Title>
                  <Alert.Description>
                    Enter the verification code WorkOS sent to{' '}
                    {pendingVerification.email}.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : error ? (
              <Alert.Root status="error" mb="4">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Could not complete signup</Alert.Title>
                  <Alert.Description>{error.message}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : null}
            {verificationRequired ? (
              <form onSubmit={submitVerification}>
                <Stack gap="4">
                  {verification.error ? (
                    <Alert.Root status="error">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Could not verify code</Alert.Title>
                        <Alert.Description>
                          {verification.error.message}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert.Root>
                  ) : null}
                  <Field.Root required>
                    <Field.Label>Verification code</Field.Label>
                    <Input
                      value={verificationCode}
                      onChange={(event) =>
                        setVerificationCode(event.currentTarget.value)
                      }
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      placeholder="Enter code"
                    />
                  </Field.Root>
                  <Button
                    type="submit"
                    loading={verification.isPending}
                    disabled={!verificationCode.trim()}
                  >
                    Verify and continue
                  </Button>
                </Stack>
              </form>
            ) : (
              <Form form={form}>
                <form.Layout>
                  <form.AppField name="email">
                    {(field) => (
                      <field.TextField
                        label="Email"
                        autoComplete="email"
                        type="email"
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="password">
                    {(field) => (
                      <field.TextField
                        label="Password"
                        type="password"
                        autoComplete="password"
                      />
                    )}
                  </form.AppField>

                  <Link to="/forgot-password" mt="-2">
                    Forgot your password?
                  </Link>

                  <form.SubmitButton
                    loadingText="Creating account..."
                    disabled={isPending || isSuccess}
                  >
                    Sign up
                  </form.SubmitButton>
                </form.Layout>
              </Form>
            )}
          </AuthCard>

          <Text textAlign="center" color="fg.muted" mt="4">
            By signing up, you agree to our{' '}
              <a href="/terms">Terms of Service</a> and{' '}
              <a href="/privacy">Privacy Policy</a>.
          </Text>
        </Container>
      </Stack>
      <Stack flex="1" bg="accent.solid">
        <Center flex="1">
          <Testimonial />
        </Center>
      </Stack>
    </Stack>
  )
}
