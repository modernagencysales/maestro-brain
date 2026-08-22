import { useCallback, useEffect, useRef, useState } from "react";

export const useOpenState = (
  props: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (details: { open: boolean }) => void;
  } = {},
) => {
  const [value, setValue] = useState(props.defaultOpen);

  const isControlled = props.open !== undefined;

  const handleChange = useRef(props.onOpenChange);

  useEffect(() => {
    handleChange.current = props.onOpenChange;
  }, [props.onOpenChange]);

  const setOpen: React.Dispatch<React.SetStateAction<boolean | undefined>> =
    useCallback(
      (nextValue) =>
        applyOpenStateChange({
          currentValue: props.open,
          handleChange,
          isControlled,
          nextValue,
          setValue,
        }),
      [isControlled, props.open, handleChange],
    );

  return {
    open: isControlled ? props.open : value,
    setOpen,
    onOpenChange: ({ open }: { open: boolean }) => setOpen(open),
  };
};

const applyOpenStateChange = ({
  currentValue,
  handleChange,
  isControlled,
  nextValue,
  setValue,
}: {
  currentValue: boolean | undefined;
  handleChange: React.MutableRefObject<
    ((details: { open: boolean }) => void) | undefined
  >;
  isControlled: boolean;
  nextValue: React.SetStateAction<boolean | undefined>;
  setValue: React.Dispatch<React.SetStateAction<boolean | undefined>>;
}) => {
  if (!isControlled) return setValue(nextValue);
  const value = resolveOpenValue(nextValue, currentValue);
  if (value !== currentValue) handleChange.current?.({ open: !!value });
};

const resolveOpenValue = (
  nextValue: React.SetStateAction<boolean | undefined>,
  currentValue: boolean | undefined,
) => (typeof nextValue === "function" ? nextValue(currentValue) : nextValue);
