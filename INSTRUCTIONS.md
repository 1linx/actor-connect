Hey Claude. You (or a version of you) and I recently made a nifty little app that connects two movies or TV shows by cast and crew using TMDB API (https://developer.themoviedb.org/docs/getting-started). You can find it here: /Users/alistairwarmington/Websites/Personal/actor-search

This works wonderfully and gives me an idea for a little movie trivia game. In that game, a user would get a start movie and an end movie, then a list of movies that connect them. The connection would be the actors that appear in them. So here's an example.

Start movie: Con Air (1997)
Connection 1: [Nicolas Cage]
Connection 2: [Sean Connery]
Connection 3: [Sam Neil]
Connection 4: [Laura Dern]
Connection 5: [Dennis Hoppper]
End movie: Waterworld (1995)

Movie connections:
The Rock (1996)
The Hunt for Red October (1990)
Jurassic Park (1991)
Blue Velvet (1986)

The actor connectinos would not be displayed until the user dragged the correct movie onto the conncetion space, then it would reveal the actor. There would be a 3 strikes system. All movie and cast data will be drawn from TMDB API.

This is a two phase procet. Phase one is to get the concept running with manually selected conncetions. We'll need a way for me to set these. 

The second phase would be an automatic process to create the connections. This would involve multiple calls to the TMDB API so we need to be a bit sparing about it so we don't hammer their API endpoint. Hold fire on that for now, but bear in mind. 

It would be ideal to use the same tech stack (Node + Svelte + tailwind), but I might want to incorporate it into a Laravel project, so it should also be built from the perspective that we might be iframing it from the Laravel project and passing data to and from it.

Build out the concept using the example above. bear in mind that this must be a mobile-first design.