import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

/** Typed Redux hooks — use these, not the untyped versions. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
