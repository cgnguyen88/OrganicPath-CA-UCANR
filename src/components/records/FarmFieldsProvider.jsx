import { FarmFieldsContext, useLoadFarmFields } from './farmFields.js';

/** Loads a farm's field list once and shares it with every records screen below (the forms, the field page, a record's detail). */
export default function FarmFieldsProvider({ farmId, children }) {
  const value = useLoadFarmFields(farmId);
  return <FarmFieldsContext.Provider value={value}>{children}</FarmFieldsContext.Provider>;
}
