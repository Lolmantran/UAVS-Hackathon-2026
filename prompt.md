I want to build a mcp server with AI workflow, the first step is to help me refine the problem and solution and write me a products.md files, so grill me if you find something unclear or you have any concerns: 
The idea is to build a service/mcp service that take in prompt and image from user AI agent. I doesnt have to be clothing, the products that we offer can be from a general ranges (so think amazon)
  
  
We have identify some user stories: 
- Search for exact product using complex query or reference images (ie. can you find me skincare product that help me reduce acne, I have oily skin) or (find me an earbud with active noise cancelation, good sound quality and black color, under 200 aud)
- Using existing image or another product and tailor to match their needs: i.e find me a white shirt with cooling material suitable for a wedding that looking my reference images
- Find product that go with existing product:  find me a pant that go with this shirt etc
- As product provider, we want to market our product to user, offering deal and dynamic bundling to increase sale (when user ask for facewash, we can recommend toner and moisturiser that goes with it, at a slight discount to boost sale)
- when we show products to user, we need to justify the product. Ideally by showing products ranking based on the criteria user offers and maybe show a few rejected items that might have match (secondary products to give the user the impression that we consider more products than the top products that get recommended)

In term of architecture, what I imagine is a a AI workflow, we receive prompts and images from user. If the prompt is clear, we clasify the user use case and use the correct pipeline, which break down the user prompt and user image into categories/metadata we supported, and then use that to query our product database. if user want to search exact, we can also use multimodel embedding/RAG system to find the most similar products we offered. If the prompt is unclear or subject to personal preference (we will ask the user some clarification question to improve query result: for example, if user ask for a bottoms that match their submitted shirt, then we ask what material they like. shorts or long length, baggy or straight fit etc). All the workflow should be generic so that it applies to all types of products, make sure to utilise the semantic strength of AI agent.

