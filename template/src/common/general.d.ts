/**
 * General types shared between the Panorama front-end and the VScripts
 * back-end. Only put things here that BOTH sides genuinely need.
 */

interface PlayerScore {
    playerId: number;
    kills: number;
}
