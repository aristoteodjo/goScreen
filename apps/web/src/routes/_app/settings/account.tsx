import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { useAppForm } from "@/components/form";
import { PageHeader } from "@/components/PageHeader";
import { FieldGroup } from "@/components/ui/field";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/errors";

export const Route = createFileRoute("/_app/settings/account")({
  component: AccountPage,
});

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty.").max(80),
});

function AccountPage() {
  const { session } = Route.useRouteContext();
  const router = useRouter();

  const updateUser = useMutation({
    mutationFn: async (values: z.infer<typeof accountSchema>) => {
      const { data, error } = await authClient.updateUser(values);
      if (error) throw new Error(error.message ?? "Update failed.");
      return data;
    },
    onSuccess: async (data) => {
      if (!data?.status) {
        toast.error("Unexpected response from the server.");
        return;
      }
      toast.success("Profile updated");
      await router.invalidate();
    },
    onError: (e) => toast.error(authErrorMessage(e)),
  });

  const form = useAppForm({
    defaultValues: { name: session.user.name },
    validators: { onChange: accountSchema },
    onSubmit: ({ value }) => updateUser.mutate(value),
  });

  return (
    <>
      <PageHeader title="Account" description={session.user.email} />
      <form
        className="max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppForm>
          <FieldGroup>
            <form.AppField name="name">{(field) => <field.TextField label="Display name" />}</form.AppField>
            <form.SubmitButton pending={updateUser.isPending}>Save</form.SubmitButton>
          </FieldGroup>
        </form.AppForm>
      </form>
    </>
  );
}
