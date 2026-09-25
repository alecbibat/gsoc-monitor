import { afterEach, describe, expect, it } from 'vitest';
import { mapToolOwnsCursor } from './cursorOwner';
import { useMeasureStore } from '../measure/measureStore';
import { useFuelZoneStore } from '../fuelzone/fuelZoneStore';
import { useHoverStore } from '../screensaver/hoverStore';
import { useCrisisStore } from '../crisis/crisisStore';

// The one guard every click-to-identify handler checks before opening panels.

afterEach(() => {
  useMeasureStore.setState({ active: false });
  useFuelZoneStore.setState({ active: false });
  useHoverStore.setState({ picking: false });
  useCrisisStore.setState({ activeDrawLayerId: null });
});

describe('mapToolOwnsCursor', () => {
  it('is false when no tool is running', () => {
    expect(mapToolOwnsCursor()).toBe(false);
  });

  it('is true while a crisis layer is being drawn', () => {
    useCrisisStore.setState({ activeDrawLayerId: 'layer-1' });
    expect(mapToolOwnsCursor()).toBe(true);
  });

  it('is true while measuring, analysing a fuel zone or picking a hover center', () => {
    useMeasureStore.setState({ active: true });
    expect(mapToolOwnsCursor()).toBe(true);
    useMeasureStore.setState({ active: false });
    useFuelZoneStore.setState({ active: true });
    expect(mapToolOwnsCursor()).toBe(true);
    useFuelZoneStore.setState({ active: false });
    useHoverStore.setState({ picking: true });
    expect(mapToolOwnsCursor()).toBe(true);
  });
});
