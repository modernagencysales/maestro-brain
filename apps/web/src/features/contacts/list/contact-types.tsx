import * as React from "react";

import { SegmentedControl } from "@workspace/ui/segmented-control";

import { contactTypes, getContactType } from "./get-contact-type";

const segments = contactTypes.map((type) => ({
  id: type.id,
  label: type.label,
}));

export const ContactTypes = () => {
  const [value, setValue] = React.useState("all");

  const setType = (id: string | null) => {
    if (!id) return;
    const type = getContactType(id);

    if (!type) return;

    setValue(type.id);
  };

  return (
    <SegmentedControl
      segments={segments}
      value={value}
      onChange={setType}
      size="xs"
    />
  );
};
