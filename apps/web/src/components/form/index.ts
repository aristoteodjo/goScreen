import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./context";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField },
  formComponents: { SubmitButton },
});
