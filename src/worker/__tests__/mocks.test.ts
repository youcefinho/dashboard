// ── Tests mock-gcal + mock-gbp — fixtures statiques ──
import { describe, it, expect } from 'vitest';
import { getMockCalendarEvents } from '../mocks/mock-gcal';
import { getMockGbpReviews } from '../mocks/mock-gbp';

describe('mock-gcal', () => {
  it('retourne 8 events', () => {
    const events = getMockCalendarEvents();
    expect(events).toHaveLength(8);
  });

  it('chaque event a les champs requis', () => {
    const events = getMockCalendarEvents();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.summary).toBeTruthy();
      expect(event.start.dateTime).toBeTruthy();
      expect(event.end.dateTime).toBeTruthy();
      expect(event.start.timeZone).toBe('America/Toronto');
      expect(event.status).toBe('confirmed');
    }
  });

  it('les dates sont des ISO strings valides', () => {
    const events = getMockCalendarEvents();
    for (const event of events) {
      expect(new Date(event.start.dateTime).toISOString()).toBeTruthy();
      expect(new Date(event.end.dateTime).toISOString()).toBeTruthy();
    }
  });
});

describe('mock-gbp', () => {
  it('retourne 5 reviews avec moyenne 4.7', () => {
    const data = getMockGbpReviews();
    expect(data.reviews).toHaveLength(5);
    expect(data.averageRating).toBe(4.7);
    expect(data.totalReviewCount).toBe(5);
  });

  it('chaque review a les champs requis', () => {
    const data = getMockGbpReviews();
    for (const review of data.reviews) {
      expect(review.reviewId).toBeTruthy();
      expect(review.reviewer.displayName).toBeTruthy();
      expect(review.starRating).toBeTruthy();
      expect(review.comment).toBeTruthy();
      expect(review.createTime).toBeTruthy();
    }
  });

  it('les ratings sont des valeurs valides', () => {
    const validRatings = ['ONE', 'TWO', 'THREE', 'FOUR', 'FOUR_FIVE', 'FIVE'];
    const data = getMockGbpReviews();
    for (const review of data.reviews) {
      expect(validRatings).toContain(review.starRating);
    }
  });
});
