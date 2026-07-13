import type { Gender } from "../../types/models";
import { ChipRow, type ChipOption } from "./ChipRow";

const GENDER_OPTIONS: readonly ChipOption<Gender>[] = [
  { label: "Unspecified", value: "unspecified" },
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Other", value: "other" },
];

/** The gender chip row shared by the add-patient and edit-patient forms. */
export function GenderPicker({
  value,
  onChange,
}: {
  value: Gender;
  onChange: (gender: Gender) => void;
}) {
  return <ChipRow options={GENDER_OPTIONS} value={value} onChange={onChange} />;
}
