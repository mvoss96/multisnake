"""Generisches Uniform-Grid als Broad-Phase für Abstandsabfragen.

Der Tick prüft an mehreren Stellen „welche Objekte sind nahe an Punkt X?"
(Kollision, Food-Fressen, Food-Magnet). Naiv ist das ein All-Pairs-Loop
(O(N·M)). Dieses Raster gruppiert Objekte nach Zelle; `query` liefert nur die
Objekte der Zellen im relevanten Umkreis zurück — der Aufrufer macht den exakten
`distance_to`-Check dahinter. Das Grid ist damit ein reiner Vorfilter und ändert
das Ergebnis nicht (bit-identisch), nur die Menge der geprüften Kandidaten.

Die Zellgröße ist reines Tuning der Kandidatenmenge; die Korrektheit hängt nicht
von ihr ab, solange `query` mit dem tatsächlich benötigten Radius aufgerufen wird.
"""

import math
from collections.abc import Iterator

from .vector import Vector2


class SpatialGrid[T]:
    def __init__(self, cell_size: float) -> None:
        self.cell_size = cell_size
        self._cells: dict[tuple[int, int], list[tuple[Vector2, T]]] = {}

    def _cell_of(self, position: Vector2) -> tuple[int, int]:
        return (int(position.x // self.cell_size), int(position.y // self.cell_size))

    def insert(self, position: Vector2, item: T) -> None:
        self._cells.setdefault(self._cell_of(position), []).append((position, item))

    def query(self, position: Vector2, radius: float) -> Iterator[tuple[Vector2, T]]:
        """Yield (Position, Item) aller Einträge in den Zellen im `radius`-Umkreis.

        Es werden ganze Zellen zurückgegeben (kein exakter Abstandscheck) — der
        Aufrufer filtert selbst per `distance_to`. `rings` deckt so viele Zellen
        ab, dass jeder Punkt innerhalb `radius` garantiert in einer davon liegt.
        """
        rings = math.ceil(radius / self.cell_size)
        cx, cy = self._cell_of(position)
        for gx in range(cx - rings, cx + rings + 1):
            for gy in range(cy - rings, cy + rings + 1):
                cell = self._cells.get((gx, gy))
                if cell:
                    yield from cell
