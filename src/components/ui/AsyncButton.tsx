"use client";

import React, {
  ButtonHTMLAttributes,
  ReactNode,
  useRef,
  useState,
} from "react";

type AsyncButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> & {
  onClick?: (
    event: React.MouseEvent<HTMLButtonElement>
  ) => void | Promise<void>;

  children: ReactNode;

  loadingText?: ReactNode;
};

export default function AsyncButton({
  onClick,
  children,
  loadingText = "Processing...",
  disabled = false,
  className = "",
  ...props
}: AsyncButtonProps) {
  const [loading, setLoading] = useState(false);

  // Extra protection against extremely fast double-clicks
  const isRunningRef = useRef(false);

  const handleClick = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();

    // Prevent duplicate execution
    if (loading || isRunningRef.current || disabled) {
      return;
    }

    if (!onClick) {
      return;
    }

    try {
      isRunningRef.current = true;
      setLoading(true);

      await Promise.resolve(onClick(event));
    } catch (error) {
      console.error("AsyncButton action failed:", error);
    } finally {
      isRunningRef.current = false;
      setLoading(false);
    }
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      onClick={handleClick}
      className={className}
    >
      {loading ? loadingText : children}
    </button>
  );
}