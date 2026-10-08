import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/components/form";
import { FieldGroup } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_auth/login")({
  component: LoginPage,
});

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

function LoginPage() {
  const router = useRouter();

  const signIn = useMutation({
    mutationFn: async (values: z.infer<typeof loginSchema>) => {
      const { data, error } = await authClient.signIn.email(values);
      if (error) throw new Error(error.message ?? "Invalid email or password.");
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
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: loginSchema },
    onSubmit: ({ value }) => signIn.mutate(value),
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to sync projects and unlock your plan.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppForm>
          <FieldGroup>
            <form.AppField name="email">
              {(field) => <field.TextField label="Email" type="email" autoComplete="email" />}
            </form.AppField>
            <form.AppField name="password">
              {(field) => <field.TextField label="Password" type="password" autoComplete="current-password" />}
            </form.AppField>
            <form.SubmitButton pending={signIn.isPending}>Sign in</form.SubmitButton>
          </FieldGroup>
        </form.AppForm>
      </form>
      <p className="text-sm text-muted-foreground">
        New to goScreen?{" "}
        <Link to="/signup" className="text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}
