import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/components/form";
import { FieldGroup } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_auth/signup")({
  component: SignupPage,
});

const signupSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});

function SignupPage() {
  const router = useRouter();

  const signUp = useMutation({
    mutationFn: async (values: z.infer<typeof signupSchema>) => {
      const { data, error } = await authClient.signUp.email(values);
      if (error) throw new Error(error.message ?? "Could not create the account.");
      return data;
    },
    onSuccess: async (data) => {
      if (!data?.user?.id) {
        toast.error("Unexpected response from the server.");
        return;
      }
      await router.invalidate();
      await router.navigate({ to: "/projects" });
    },
    onError: (error) => toast.error(authErrorMessage(error)),
  });

  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: { onSubmit: signupSchema },
    onSubmit: ({ value }) => signUp.mutate(value),
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Free forever. Upgrade when you need 4K and sharing.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppForm>
          <FieldGroup>
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" autoComplete="name" />}
            </form.AppField>
            <form.AppField name="email">
              {(field) => <field.TextField label="Email" type="email" autoComplete="email" />}
            </form.AppField>
            <form.AppField name="password">
              {(field) => (
                <field.TextField
                  label="Password"
                  type="password"
                  autoComplete="new-password"
                  description="At least 8 characters."
                />
              )}
            </form.AppField>
            <form.SubmitButton pending={signUp.isPending}>Create account</form.SubmitButton>
          </FieldGroup>
        </form.AppForm>
      </form>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
