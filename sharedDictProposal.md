# Design choices
# 1. Can the shared dictionary be *included* in the document
# 2. How do we handle when 2 dictionaries conflict in numerical id (I think the best way of doing this is for the dictionary to advertise it's size and then for the software to add offsets for new IDs)

@prefix foaf: <http://example.org/foaf#>

1 foaf:friend
2 foaf:knows
3 <http://example.org#me>

1 3 {| 5 7 8 |} .
