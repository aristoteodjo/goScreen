import type { ComponentProps } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFieldContext } from "./context";

type Props = {
  label: string;
  description?: string;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "name" | "id">;

export function TextField({ label, description, ...inputProps }: Props) {
  const field = useFieldContext<string>();
  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={invalid || undefined}
        {...inputProps}
      />
      {description && !invalid ? <FieldDescription>{description}</FieldDescription> : null}
      {invalid ? <FieldError errors={field.state.meta.errors} /> : null}
    </Field>
  );
}
