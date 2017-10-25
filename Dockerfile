# Apify base image with selenium web driver with chrome
FROM apify/actor-node-chrome
COPY . ./
RUN npm install
CMD [ "node", "main.js" ]